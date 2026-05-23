export const CHANNEL_META = {
    web: {name: '本地', icon: '本', iconClass: 'web', badge: '本地'},
    feishu: {name: '飞书', icon: '飞', iconClass: 'feishu', badge: '飞书'},
    qqbot: {name: 'QQ', icon: 'Q', iconClass: 'qq', badge: 'QQ'},
    weixin: {name: '微信', icon: '微', iconClass: 'weixin', badge: '微信'},
    dingtalk: {name: '钉钉', icon: '钉', iconClass: 'dingtalk', badge: '钉钉'},
    telegram: {name: 'Telegram', icon: 'T', iconClass: 'telegram', badge: 'TG'},
    discord: {name: 'Discord', icon: 'D', iconClass: 'discord', badge: 'DC'},
};

export function getChannelMeta(type) {
    var channelType = type || '';
    return CHANNEL_META[channelType] || {
        name: channelType,
        icon: channelType.charAt(0).toUpperCase(),
        iconClass: 'default',
    };
}
