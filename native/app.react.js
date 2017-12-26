// @flow

import type {
  NavigationState,
  PossiblyDeprecatedNavigationAction,
  NavigationScreenProp,
} from 'react-navigation';
import type { Dispatch } from 'lib/types/redux-types';
import type { AppState } from './redux-setup';
import type { Action } from './navigation-setup';
import type { PingResult, PingStartingPayload } from 'lib/types/ping-types';
import type {
  DispatchActionPayload,
  DispatchActionPromise,
} from 'lib/utils/action-utils';
import type { CalendarQuery } from 'lib/selectors/nav-selectors';
import type {
  ActivityUpdate,
  UpdateActivityResult,
} from 'lib/actions/ping-actions';
import type { PushPermissions } from './push';

import React from 'react';
import { Provider, connect } from 'react-redux';
import {
  AppRegistry,
  Platform,
  UIManager,
  AppState as NativeAppState,
  Linking,
  View,
  StyleSheet,
  PushNotificationIOS,
} from 'react-native';
import { addNavigationHelpers } from 'react-navigation';
import invariant from 'invariant';
import PropTypes from 'prop-types';

import { registerConfig } from 'lib/utils/config';
import {
  includeDispatchActionProps,
  bindServerCalls,
} from 'lib/utils/action-utils';
import { pingActionTypes, ping } from 'lib/actions/ping-actions';
import { sessionInactivityLimit } from 'lib/selectors/session-selectors';
import { newSessionIDActionType } from 'lib/reducers/session-reducer';
import {
  updateActivityActionTypes,
  updateActivity,
} from 'lib/actions/ping-actions';
import {
  setDeviceTokenActionTypes,
  setDeviceToken,
} from 'lib/actions/device-actions';

import {
  handleURLActionType,
  RootNavigator,
  AppRouteName,
} from './navigation-setup';
import { store } from './redux-setup';
import { resolveInvalidatedCookie } from './account/native-credentials';
import { pingNativeStartingPayload } from './selectors/ping-selectors';
import ConnectedStatusBar from './connected-status-bar.react';
import {
  activeThreadSelector,
  createIsForegroundSelector,
} from './selectors/nav-selectors';
import { requestPushPermissions } from './push';

let urlPrefix;
if (!__DEV__) {
  urlPrefix = "https://squadcal.org/";
} else if (Platform.OS === "android") {
  // This is a magic IP address that forwards to the emulator's host
  urlPrefix = "http://10.0.2.2/~ashoat/squadcal/";
} else if (Platform.OS === "ios") {
  // Since iOS is simulated and not emulated, we can use localhost
  urlPrefix = "http://localhost/~ashoat/squadcal/";
  // Uncomment below and update IP address if testing on physical device
  //urlPrefix = "http://192.168.1.3/~ashoat/squadcal/";
} else {
  invariant(false, "unsupported platform");
}
registerConfig({
  urlPrefix,
  resolveInvalidatedCookie,
  getNewCookie: async (response: Object) => {
    if (response.cookie_change && response.cookie_change.cookie) {
      return response.cookie_change.cookie;
    }
    return null;
  },
  setCookieOnRequest: true,
  calendarRangeInactivityLimit: sessionInactivityLimit,
});

// We can't push yet, so we rely on pings to keep Redux state updated with the
// server. As a result, we do them fairly frequently (once every 3s) while the
// app is active and the user is logged in.
const pingFrequency = 3 * 1000;

type NativeDispatch = Dispatch
  & ((action: PossiblyDeprecatedNavigationAction) => boolean);

type Props = {
  // Redux state
  cookie: ?string,
  navigationState: NavigationState,
  pingStartingPayload: () => PingStartingPayload,
  currentAsOf: number,
  activeThread: ?string,
  appLoggedIn: bool,
  activeThreadLatestMessage: ?string,
  deviceToken: ?string,
  // Redux dispatch functions
  dispatch: NativeDispatch,
  dispatchActionPayload: DispatchActionPayload,
  dispatchActionPromise: DispatchActionPromise,
  // async functions that hit server APIs
  ping: (
    calendarQuery: CalendarQuery,
    lastPing: number,
  ) => Promise<PingResult>,
  updateActivity: (
    activityUpdates: $ReadOnlyArray<ActivityUpdate>,
  ) => Promise<UpdateActivityResult>,
  setDeviceToken: (deviceToken: string) => Promise<string>,
};
class AppWithNavigationState extends React.PureComponent<Props> {

  static propTypes = {
    cookie: PropTypes.string,
    navigationState: PropTypes.object.isRequired,
    pingStartingPayload: PropTypes.func.isRequired,
    currentAsOf: PropTypes.number.isRequired,
    activeThread: PropTypes.string,
    appLoggedIn: PropTypes.bool.isRequired,
    activeThreadLatestMessage: PropTypes.string,
    deviceToken: PropTypes.string,
    dispatch: PropTypes.func.isRequired,
    dispatchActionPayload: PropTypes.func.isRequired,
    dispatchActionPromise: PropTypes.func.isRequired,
    ping: PropTypes.func.isRequired,
    updateActivity: PropTypes.func.isRequired,
    setDeviceToken: PropTypes.func.isRequired,
  };
  currentState: ?string = NativeAppState.currentState;
  activePingSubscription: ?number = null;

  componentDidMount() {
    NativeAppState.addEventListener('change', this.handleAppStateChange);
    this.handleInitialURL().then();
    Linking.addEventListener('url', this.handleURLChange);
    this.activePingSubscription = setInterval(this.ping, pingFrequency);
    AppWithNavigationState.updateFocusedThreads(
      this.props,
      this.props.activeThread,
      null,
      null,
    );
    PushNotificationIOS.addEventListener(
      "register",
      this.registerPushPermissions,
    );
  }

  async handleInitialURL() {
    const url = await Linking.getInitialURL();
    if (url) {
      this.dispatchActionForURL(url);
    }
  }

  componentWillUnmount() {
    NativeAppState.removeEventListener('change', this.handleAppStateChange);
    Linking.removeEventListener('url', this.handleURLChange);
    if (this.activePingSubscription) {
      clearInterval(this.activePingSubscription);
      this.activePingSubscription = null;
    }
    this.closingApp();
    PushNotificationIOS.removeEventListener(
      "register",
      this.registerPushPermissions,
    );
  }

  handleURLChange = (event: { url: string }) => {
    this.dispatchActionForURL(event.url);
  }

  dispatchActionForURL(url: string) {
    if (!url.startsWith("http")) {
      return;
    }
    this.props.dispatchActionPayload(handleURLActionType, url);
  }

  handleAppStateChange = (nextAppState: ?string) => {
    const lastState = this.currentState;
    this.currentState = nextAppState;
    if (
      lastState &&
      lastState.match(/inactive|background/) &&
      this.currentState === "active" &&
      !this.activePingSubscription
    ) {
      this.activePingSubscription = setInterval(this.ping, pingFrequency);
      AppWithNavigationState.updateFocusedThreads(
        this.props,
        this.props.activeThread,
        null,
        null,
      );
      this.ensurePushNotifsEnabled();
    } else if (
      lastState === "active" &&
      this.currentState &&
      this.currentState.match(/inactive|background/) &&
      this.activePingSubscription
    ) {
      clearInterval(this.activePingSubscription);
      this.activePingSubscription = null;
      this.closingApp();
    }
  }

  componentWillReceiveProps(nextProps: Props) {
    const justLoggedIn = nextProps.appLoggedIn && !this.props.appLoggedIn;
    if (
      justLoggedIn ||
      nextProps.activeThread !== this.props.activeThread
    ) {
      AppWithNavigationState.updateFocusedThreads(
        nextProps,
        nextProps.activeThread,
        this.props.activeThread,
        this.props.activeThreadLatestMessage,
      );
    }
    if (justLoggedIn) {
      this.ensurePushNotifsEnabled();
    }
  }

  ensurePushNotifsEnabled = () => {
    if (Platform.OS === "ios") {
      PushNotificationIOS.checkPermissions(
        this.checkPushPermissionsAndRequestIfMissing,
      );
    }
  }

  checkPushPermissionsAndRequestIfMissing = (permissions: PushPermissions) => {
    let permissionNeeded = this.props.deviceToken === null
      || this.props.deviceToken === undefined;
    if (!permissionNeeded) {
      for (let permission in permissions) {
        if (!permissions[permission]) {
          permissionNeeded = true;
          break;
        }
      }
    }
    if (permissionNeeded) {
      requestPushPermissions().then();
    }
  }

  registerPushPermissions = (deviceToken: string) => {
    this.props.dispatchActionPromise(
      setDeviceTokenActionTypes,
      this.props.setDeviceToken(deviceToken),
    );
  }

  ping = () => {
    const startingPayload = this.props.pingStartingPayload();
    if (
      startingPayload.loggedIn ||
      (this.props.cookie && this.props.cookie.startsWith("user="))
    ) {
      this.props.dispatchActionPromise(
        pingActionTypes,
        this.pingAction(startingPayload),
        undefined,
        startingPayload,
      );
    } else if (startingPayload.newSessionID) {
      // Normally, the PING_STARTED will handle setting a new sessionID if the
      // user hasn't interacted in a bit. Since we don't run pings when logged
      // out, we use another action for it.
      this.props.dispatchActionPayload(
        newSessionIDActionType,
        startingPayload.newSessionID,
      );
    }
  }

  async pingAction(startingPayload: PingStartingPayload) {
    const pingResult = await this.props.ping(
      startingPayload.calendarQuery,
      this.props.currentAsOf,
    );
    return {
      ...pingResult,
      loggedIn: startingPayload.loggedIn,
    };
  }

  static updateFocusedThreads(
    props: Props,
    activeThread: ?string,
    oldActiveThread: ?string,
    oldActiveThreadLatestMessage: ?string,
  ) {
    if (!props.appLoggedIn) {
      return;
    }
    const updates = [];
    if (activeThread) {
      updates.push({
        focus: true,
        threadID: activeThread,
      });
    }
    if (oldActiveThread && oldActiveThread !== activeThread) {
      updates.push({
        focus: false,
        threadID: oldActiveThread,
        latestMessage: oldActiveThreadLatestMessage,
      });
    }
    if (updates.length === 0) {
      return;
    }
    props.dispatchActionPromise(
      updateActivityActionTypes,
      props.updateActivity(updates),
    );
  }

  closingApp() {
    if (!this.props.appLoggedIn) {
      return;
    }
    const updates = [];
    updates.push({
      closing: true,
    });
    if (this.props.activeThread) {
      updates.push({
        focus: false,
        threadID: this.props.activeThread,
        latestMessage: this.props.activeThreadLatestMessage,
      });
    }
    this.props.dispatchActionPromise(
      updateActivityActionTypes,
      this.props.updateActivity(updates),
    );
  }

  render() {
    const navigation: NavigationScreenProp<any> = addNavigationHelpers({
      dispatch: this.props.dispatch,
      state: this.props.navigationState,
    });
    return (
      <View style={styles.app}>
        <RootNavigator navigation={navigation} />
        <ConnectedStatusBar />
      </View>
    );
  }

}

const styles = StyleSheet.create({
  app: {
    flex: 1,
  },
});

const isForegroundSelector = createIsForegroundSelector(AppRouteName);
const ConnectedAppWithNavigationState = connect(
  (state: AppState) => {
    const activeThread = activeThreadSelector(state);
    return {
      cookie: state.cookie,
      navigationState: state.navInfo.navigationState,
      pingStartingPayload: pingNativeStartingPayload(state),
      currentAsOf: state.currentAsOf,
      activeThread,
      appLoggedIn: isForegroundSelector(state),
      activeThreadLatestMessage:
        activeThread && state.messageStore.threads[activeThread]
          ? state.messageStore.threads[activeThread].messageIDs[0]
          : null,
      deviceToken: state.deviceToken,
    };
  },
  includeDispatchActionProps,
  bindServerCalls({ ping, updateActivity, setDeviceToken }),
)(AppWithNavigationState);

const App = (props: {}) =>
  <Provider store={store}>
    <ConnectedAppWithNavigationState />
  </Provider>;
AppRegistry.registerComponent('SquadCal', () => App);
