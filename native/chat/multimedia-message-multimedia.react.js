// @flow

import { type MediaInfo, mediaInfoPropType } from 'lib/types/media-types';
import type { ImageStyle } from '../types/styles';
import {
  type Navigate,
  MultimediaModalRouteName,
} from '../navigation/route-names';
import {
  type VerticalBounds,
  verticalBoundsPropType,
} from '../media/vertical-bounds';
import {
  type PendingMultimediaUpload,
  pendingMultimediaUploadPropType,
} from './chat-input-state';

import * as React from 'react';
import PropTypes from 'prop-types';
import { View, TouchableWithoutFeedback, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import Multimedia from '../media/multimedia.react';

type Props = {|
  mediaInfo: MediaInfo,
  navigate: Navigate,
  verticalBounds: ?VerticalBounds,
  style?: ImageStyle,
  modalsClosed: bool,
  lightboxPosition: ?Animated.Value,
  pendingUpload: ?PendingMultimediaUpload,
|};
type State = {|
  hidden: bool,
  opacity: ?Animated.Value,
|};
class MultimediaMessageMultimedia extends React.PureComponent<Props, State> {

  static propTypes = {
    mediaInfo: mediaInfoPropType.isRequired,
    navigate: PropTypes.func.isRequired,
    verticalBounds: verticalBoundsPropType,
    modalsClosed: PropTypes.bool.isRequired,
    lightboxPosition: PropTypes.instanceOf(Animated.Value),
    pendingUpload: pendingMultimediaUploadPropType,
  };
  view: ?View;

  constructor(props: Props) {
    super(props);
    this.state = {
      hidden: false,
      opacity: this.getOpacity(),
    };
  }

  static getDerivedStateFromProps(props: Props, state: State) {
    if (props.modalsClosed && state.hidden) {
      return { hidden: false };
    }
    return null;
  }

  getOpacity() {
    const { lightboxPosition } = this.props;
    if (!lightboxPosition) {
      return null;
    }
    return Animated.interpolate(
      this.props.lightboxPosition,
      {
        inputRange: [ 0.1, 0.11 ],
        outputRange: [ 1, 0 ],
        extrapolate: Animated.Extrapolate.CLAMP,
      },
    );
  }

  componentDidUpdate(prevProps: Props) {
    const { lightboxPosition } = this.props;
    if (lightboxPosition !== prevProps.lightboxPosition) {
      this.setState({ opacity: this.getOpacity() });
    }
  }

  render() {
    const { mediaInfo, style } = this.props;
    const wrapperStyles = [ styles.expand ];
    if (this.state.hidden && this.state.opacity) {
      wrapperStyles.push({ opacity: this.state.opacity });
    }
    return (
      <TouchableWithoutFeedback onPress={this.onPress}>
        <View style={[ styles.expand, style ]} ref={this.viewRef}>
          <Animated.View style={wrapperStyles}>
            <Multimedia mediaInfo={mediaInfo} />
          </Animated.View>
        </View>
      </TouchableWithoutFeedback>
    );
  }

  viewRef = (view: ?View) => {
    this.view = view;
  }

  onPress = () => {
    const { view, props: { verticalBounds } } = this;
    if (!view || !verticalBounds) {
      return;
    }
    view.measure((x, y, width, height, pageX, pageY) => {
      const coordinates = { x: pageX, y: pageY, width, height };
      const { mediaInfo, navigate } = this.props;
      navigate({
        routeName: MultimediaModalRouteName,
        params: { mediaInfo, initialCoordinates: coordinates, verticalBounds },
      });
      this.setState({ hidden: true });
    });
  }

}

const styles = StyleSheet.create({
  expand: {
    flex: 1,
  },
});

export default MultimediaMessageMultimedia;
