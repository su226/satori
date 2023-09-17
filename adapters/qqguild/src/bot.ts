import { Bot, Context, defineProperty, Quester, Schema, Universal } from '@satorijs/satori'
import { adaptChannel, adaptGuild, adaptUser, decodeGuildMember, decodeMessage } from './utils'
import { QQGuildMessageEncoder } from './message'
import { WsClient } from './ws'
import { Internal } from './internal'
import * as QQGuild from './types'

export class QQGuildBot extends Bot<QQGuildBot.Config> {
  static MessageEncoder = QQGuildMessageEncoder

  internal: Internal
  http: Quester

  constructor(ctx: Context, config: QQGuildBot.Config) {
    super(ctx, config)
    this.platform = 'qqguild'
    this.http = ctx.http.extend({
      endpoint: config.endpoint,
      headers: {
        Authorization: `Bot ${this.config.app.id}.${this.config.app.token}`,
      },
    })
    this.internal = new Internal(this.http)
    ctx.plugin(WsClient, this)
  }

  session(payload?: any, input?: any) {
    return defineProperty(super.session(payload), 'qqguild', Object.assign(Object.create(this.internal), input))
  }

  async initialize() {
    const self = await this.getSelf()
    this.name = self.name
    this.username = self.name
    this.selfId = self.id
    this.avatar = self.avatar
  }

  async getSelf() {
    const user = adaptUser(await this.internal.getMe())
    return user
  }

  async getGuildList(next?: string) {
    const guilds = await this.internal.getGuilds()
    return { data: guilds.map(adaptGuild) }
  }

  async getGuild(guildId: string) {
    const guild = await this.internal.getGuild(guildId)
    return adaptGuild(guild)
  }

  async getChannelList(guildId: string, next?: string): Promise<Universal.List<Universal.Channel>> {
    const channels = await this.internal.getChannels(guildId)
    return { data: channels.map(adaptChannel) }
  }

  async getChannel(channelId: string): Promise<Universal.Channel> {
    const channel = await this.internal.getChannel(channelId)
    return adaptChannel(channel)
  }

  async getGuildMemberList(guildId: string, next?: string): Promise<Universal.List<Universal.GuildMember>> {
    const members = await this.internal.getGuildMembers(guildId, {
      limit: 400,
      after: next,
    })
    return { data: members.map(decodeGuildMember), next: members[members.length - 1].user.id }
  }

  async getGuildMember(guildId: string, userId: string): Promise<Universal.GuildMember> {
    const member = await this.internal.getGuildMember(guildId, userId)
    return decodeGuildMember(member)
  }

  async kickGuildMember(guildId: string, userId: string) {
    await this.internal.deleteGuildMember(guildId, userId)
  }

  async muteGuildMember(guildId: string, userId: string, duration: number) {
    await this.internal.muteGuildMember(guildId, userId, duration)
  }

  async getReactionList(channelId: string, messageId: string, emoji: string, next?: string): Promise<Universal.List<Universal.User>> {
    const [type, id] = emoji.split(':')
    const { users, cookie } = await this.internal.getReactions(channelId, messageId, type, id, {
      limit: 50,
      cookie: next,
    })
    return { next: cookie, data: users.map(adaptUser) }
  }

  async createReaction(channelId: string, messageId: string, emoji: string) {
    const [type, id] = emoji.split(':')
    await this.internal.createReaction(channelId, messageId, type, id)
  }

  async deleteReaction(channelId: string, messageId: string, emoji: string) {
    const [type, id] = emoji.split(':')
    await this.internal.deleteReaction(channelId, messageId, type, id)
  }

  async getMessage(channelId: string, messageId: string): Promise<Universal.Message> {
    const r = await this.internal.getMessage(channelId, messageId)
    return decodeMessage(this, r)
  }

  async deleteMessage(channelId: string, messageId: string) {
    if (channelId.includes('_')) {
      // direct message
      const [guildId, _] = channelId.split('_')
      await this.internal.deleteDM(guildId, messageId)
    } else {
      await this.internal.deleteMessage(channelId, messageId)
    }
  }
}

export namespace QQGuildBot {
  type BotOptions = QQGuild.Options
  type CustomBotOptions = Omit<BotOptions, 'sandbox'> & Partial<Pick<BotOptions, 'sandbox'>>
  export interface Config extends Bot.Config, CustomBotOptions, WsClient.Config {
    intents?: number
  }

  export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
      app: Schema.object({
        id: Schema.string().description('机器人 id。').required(),
        key: Schema.string().description('机器人 key。').role('secret').required(),
        token: Schema.string().description('机器人令牌。').role('secret').required(),
        type: Schema.union(['public', 'private'] as const).description('机器人类型。').required(),
      }) as any,
      sandbox: Schema.boolean().description('是否开启沙箱模式。').default(true),
      endpoint: Schema.string().role('link').description('要连接的服务器地址。').default('https://api.sgroup.qq.com/'),
      authType: Schema.union(['bot', 'bearer'] as const).description('采用的验证方式。').default('bot'),
      intents: Schema.bitset(QQGuild.Intents).description('需要订阅的机器人事件。').default(QQGuild.Intents.PUBLIC_GUILD_MESSAGES),
    }),
    WsClient.Config,
  ] as const)
}
