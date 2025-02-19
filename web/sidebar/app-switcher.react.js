// @flow

import * as React from 'react';
import { useDispatch } from 'react-redux';

import {
  mostRecentlyReadThreadSelector,
  unreadCount,
} from 'lib/selectors/thread-selectors';

import { useSelector } from '../redux/redux-utils';
import { navTabSelector } from '../selectors/nav-selectors.js';
import SWMansionIcon from '../SWMansionIcon.react';
import { updateNavInfoActionType } from '../types/nav-types';
import css from './left-layout-aside.css';
import NavigationPanel from './navigation-panel.react';

function AppSwitcher(): React.Node {
  const activeChatThreadID = useSelector(
    state => state.navInfo.activeChatThreadID,
  );
  const mostRecentlyReadThread = useSelector(mostRecentlyReadThreadSelector);
  const isActiveThreadCurrentlyUnread = useSelector(
    state =>
      !activeChatThreadID ||
      !!state.threadStore.threadInfos[activeChatThreadID]?.currentUser.unread,
  );

  const dispatch = useDispatch();

  const onClickChat = React.useCallback(
    (event: SyntheticEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      dispatch({
        type: updateNavInfoActionType,
        payload: {
          tab: 'chat',
          activeChatThreadID: isActiveThreadCurrentlyUnread
            ? mostRecentlyReadThread
            : activeChatThreadID,
        },
      });
    },
    [
      dispatch,
      isActiveThreadCurrentlyUnread,
      mostRecentlyReadThread,
      activeChatThreadID,
    ],
  );

  const boundUnreadCount = useSelector(unreadCount);

  let chatBadge = null;
  if (boundUnreadCount > 0) {
    chatBadge = <span className={css.chatBadge}>{boundUnreadCount}</span>;
  }

  const chatNavigationItem = React.useMemo(
    () => (
      <NavigationPanel.Item tab="chat">
        <div className={css.navigationPanelTab} onClick={onClickChat}>
          <span className={css.chatIconWrapper}>
            <SWMansionIcon icon="message-square" size={24} />
            {chatBadge}
          </span>
          <p>Chat</p>
        </div>
      </NavigationPanel.Item>
    ),
    [chatBadge, onClickChat],
  );

  const onClickCalendar = React.useCallback(
    (event: SyntheticEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      dispatch({
        type: updateNavInfoActionType,
        payload: { tab: 'calendar' },
      });
    },
    [dispatch],
  );

  const isCalendarEnabled = useSelector(state => state.enabledApps.calendar);
  const calendarNavigationItem = React.useMemo(() => {
    if (!isCalendarEnabled) {
      return null;
    }
    return (
      <NavigationPanel.Item tab="calendar">
        <div className={css.navigationPanelTab} onClick={onClickCalendar}>
          <SWMansionIcon icon="calendar" size={24} />
          <p>Calendar</p>
        </div>
      </NavigationPanel.Item>
    );
  }, [isCalendarEnabled, onClickCalendar]);

  const onClickApps = React.useCallback(
    (event: SyntheticEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      dispatch({
        type: updateNavInfoActionType,
        payload: {
          tab: 'apps',
        },
      });
    },
    [dispatch],
  );

  const appNavigationItem = React.useMemo(
    () => (
      <NavigationPanel.Item tab="apps">
        <div className={css.navigationPanelTab} onClick={onClickApps}>
          <SWMansionIcon icon="globe-1" size={24} />
          <p>Apps</p>
        </div>
      </NavigationPanel.Item>
    ),
    [onClickApps],
  );

  return (
    <NavigationPanel.Container tabSelector={navTabSelector}>
      {chatNavigationItem}
      {calendarNavigationItem}
      {appNavigationItem}
    </NavigationPanel.Container>
  );
}

export default AppSwitcher;
