// @flow

import type {
  ChatRobotextMessageInfoItemWithHeight,
} from './robotext-message.react';
import type {
  ChatTextMessageInfoItemWithHeight,
} from './text-message.react';
import type {
  ChatMultimediaMessageInfoItem,
} from './multimedia-message.react';
import { chatMessageItemPropType } from 'lib/selectors/chat-selectors';
import {
  type VerticalBounds,
  verticalBoundsPropType,
} from '../types/lightbox-types';
import {
  type MessageListNavProp,
  messageListNavPropType,
} from './message-list-types';
import {
  type KeyboardState,
  keyboardStatePropType,
  withKeyboardState,
} from '../navigation/keyboard-state';

import * as React from 'react';
import {
  View,
  LayoutAnimation,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import PropTypes from 'prop-types';

import { TextMessage, textMessageItemHeight } from './text-message.react';
import {
  RobotextMessage,
  robotextMessageItemHeight,
} from './robotext-message.react';
import {
  MultimediaMessage,
  multimediaMessageItemHeight,
} from './multimedia-message.react';
import { timestampHeight } from './timestamp.react';

export type ChatMessageInfoItemWithHeight =
  | ChatRobotextMessageInfoItemWithHeight
  | ChatTextMessageInfoItemWithHeight
  | ChatMultimediaMessageInfoItem;

function messageItemHeight(
  item: ChatMessageInfoItemWithHeight,
  viewerID: ?string,
) {
  let height = 0;
  if (item.messageShapeType === "text") {
    height += textMessageItemHeight(item, viewerID);
  } else if (item.messageShapeType === "multimedia") {
    height += multimediaMessageItemHeight(item, viewerID);
  } else {
    height += robotextMessageItemHeight(item, viewerID);
  }
  if (item.startsConversation) {
    height += timestampHeight + 1;
  }
  return height;
}

type Props = {|
  item: ChatMessageInfoItemWithHeight,
  focused: bool,
  navigation: MessageListNavProp,
  toggleFocus: (messageKey: string) => void,
  verticalBounds: ?VerticalBounds,
  // withKeyboardState
  keyboardState: ?KeyboardState,
|};
class Message extends React.PureComponent<Props> {

  static propTypes = {
    item: chatMessageItemPropType.isRequired,
    focused: PropTypes.bool.isRequired,
    navigation: messageListNavPropType.isRequired,
    toggleFocus: PropTypes.func.isRequired,
    verticalBounds: verticalBoundsPropType,
    keyboardState: keyboardStatePropType,
  };

  componentDidUpdate(prevProps: Props) {
    if (
      (prevProps.focused || prevProps.item.startsConversation) !==
        (this.props.focused || this.props.item.startsConversation)
    ) {
      LayoutAnimation.easeInEaseOut();
    }
  }

  render() {
    let message;
    if (this.props.item.messageShapeType === "text") {
      message = (
        <TextMessage
          item={this.props.item}
          navigation={this.props.navigation}
          focused={this.props.focused}
          toggleFocus={this.props.toggleFocus}
          verticalBounds={this.props.verticalBounds}
        />
      );
    } else if (this.props.item.messageShapeType === "multimedia") {
      message = (
        <MultimediaMessage
          item={this.props.item}
          navigation={this.props.navigation}
          focused={this.props.focused}
          toggleFocus={this.props.toggleFocus}
          verticalBounds={this.props.verticalBounds}
        />
      );
    } else {
      message = (
        <RobotextMessage
          item={this.props.item}
          focused={this.props.focused}
          toggleFocus={this.props.toggleFocus}
        />
      );
    }
    if (Platform.OS === "android" && Platform.Version < 21) {
      // On old Android 4.4 devices, we can get a stack overflow during draw
      // when we use the TouchableWithoutFeedback below. It's just too deep of
      // a stack for the old hardware to handle
      return message;
    }
    return (
      <TouchableWithoutFeedback onPress={this.dismissKeyboard}>
        {message}
      </TouchableWithoutFeedback>
    );
  }

  dismissKeyboard = () => {
    const { keyboardState } = this.props;
    keyboardState && keyboardState.dismissKeyboard();
  }

}

const WrappedMessage = withKeyboardState(Message);

export {
  WrappedMessage as Message,
  messageItemHeight,
};
