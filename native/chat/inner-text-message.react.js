// @flow

import { chatMessageItemPropType } from 'lib/selectors/chat-selectors';
import type { ChatTextMessageInfoItemWithHeight } from './text-message.react';
import { type GlobalTheme, globalThemePropType } from '../types/themes';
import type { AppState } from '../redux/redux-setup';

import * as React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import PropTypes from 'prop-types';
import Hyperlink from 'react-native-hyperlink';

import { colorIsDark } from 'lib/shared/thread-utils';
import { onlyEmojiRegex } from 'lib/shared/emojis';
import { connect } from 'lib/utils/redux-utils';

import {
  allCorners,
  filterCorners,
  getRoundedContainerStyle,
} from './rounded-corners';
import {
  type Colors,
  colorsPropType,
  colorsSelector,
  colors,
} from '../themes/colors';

type Props = {|
  item: ChatTextMessageInfoItemWithHeight,
  onPress: () => void,
  messageRef?: (message: ?React.ElementRef<typeof View>) => void,
  // Redux state
  activeTheme: ?GlobalTheme,
  colors: Colors,
|};
class InnerTextMessage extends React.PureComponent<Props> {
  static propTypes = {
    item: chatMessageItemPropType.isRequired,
    onPress: PropTypes.func.isRequired,
    messageRef: PropTypes.func,
    activeTheme: globalThemePropType,
    colors: colorsPropType.isRequired,
  };

  render() {
    const { item } = this.props;
    const { text, creator } = item.messageInfo;
    const { isViewer } = creator;

    let messageStyle = {},
      textCustomStyle = {},
      darkColor;
    if (isViewer) {
      const threadColor = item.threadInfo.color;
      messageStyle.backgroundColor = `#${threadColor}`;
      darkColor = colorIsDark(threadColor);
    } else {
      messageStyle.backgroundColor = this.props.colors.listChatBubble;
      darkColor = this.props.activeTheme === 'dark';
    }
    textCustomStyle.height = item.contentHeight;

    const linkStyle = darkColor ? styles.lightLinkText : styles.darkLinkText;
    textCustomStyle.color = darkColor
      ? colors.dark.listForegroundLabel
      : colors.light.listForegroundLabel;
    const textStyle = onlyEmojiRegex.test(text)
      ? styles.emojiOnlyText
      : styles.text;

    const cornerStyle = getRoundedContainerStyle(
      filterCorners(allCorners, item),
    );

    const message = (
      <TouchableOpacity
        onPress={this.props.onPress}
        onLongPress={this.props.onPress}
        activeOpacity={0.6}
      >
        <Hyperlink
          linkDefault={true}
          style={[styles.message, messageStyle, cornerStyle]}
          linkStyle={linkStyle}
        >
          <Text
            onPress={this.props.onPress}
            onLongPress={this.props.onPress}
            style={[textStyle, textCustomStyle]}
          >
            {text}
          </Text>
        </Hyperlink>
      </TouchableOpacity>
    );

    const { messageRef } = this.props;
    if (!messageRef) {
      return message;
    }

    return (
      <View onLayout={this.onLayout} ref={messageRef}>
        {message}
      </View>
    );
  }

  onLayout = () => {};
}

const styles = StyleSheet.create({
  darkLinkText: {
    color: colors.light.link,
    textDecorationLine: 'underline',
  },
  emojiOnlyText: {
    fontFamily: 'Arial',
    fontSize: 36,
  },
  lightLinkText: {
    color: colors.dark.link,
    textDecorationLine: 'underline',
  },
  message: {
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  text: {
    fontFamily: 'Arial',
    fontSize: 18,
  },
});

export default connect((state: AppState) => ({
  activeTheme: state.globalThemeInfo.activeTheme,
  colors: colorsSelector(state),
}))(InnerTextMessage);
