#import <Expo/Expo.h>
#import <React/RCTBridgeDelegate.h>
#import <UIKit/UIKit.h>

@interface AppDelegate : EXAppDelegateWrapper <RCTBridgeDelegate>

@property(nonatomic, strong) UIWindow *window;

@end
