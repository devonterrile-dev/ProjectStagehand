import { DiscordSDK } from '@discord/embedded-app-sdk';

/** The Discord permissions the Activity test asks for. */
export type ActivityScope = 'identify' | 'rpc.voice.read';

export type SpeakingKind = 'start' | 'stop';

/** The few parts of Discord's Embedded App SDK that Stagehand uses. */
export interface ActivitySdk {
  /** "desktop" (the desktop app and the website) or "mobile". */
  readonly platform: string;
  /** Resolves once the frame and the Discord client have shaken hands. */
  ready(): Promise<void>;
  /** Asks the user to allow the scopes (Discord shows its own dialog); resolves to a code. */
  authorize(scopes: readonly ActivityScope[]): Promise<string>;
  /** Signs the SDK in with the token the server got for that code; resolves to its scopes. */
  authenticate(accessToken: string): Promise<string[]>;
  /**
   * Calls `listener` whenever someone in this voice channel starts or stops talking. Needs
   * the `rpc.voice.read` scope. Resolves to a function that ends it.
   */
  subscribeSpeaking(listener: (kind: SpeakingKind, userId: string) => void): Promise<() => void>;
}

let current: { clientId: string; sdk: ActivitySdk } | null = null;

/**
 * The SDK for this page. Made once: each `DiscordSDK` starts its own handshake with the
 * Discord client. Only works inside Discord's frame (the SDK reads `frame_id` from the URL).
 */
export function activitySdk(clientId: string): ActivitySdk {
  if (current?.clientId === clientId) return current.sdk;
  const discord = new DiscordSDK(clientId);

  const sdk: ActivitySdk = {
    platform: discord.platform,
    ready: () => discord.ready(),
    authorize: async (scopes) => {
      const { code } = await discord.commands.authorize({
        client_id: clientId,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: [...scopes],
      });
      return code;
    },
    authenticate: async (accessToken) => {
      const { scopes } = await discord.commands.authenticate({ access_token: accessToken });
      return scopes.filter((scope) => typeof scope === 'string');
    },
    subscribeSpeaking: async (listener) => {
      const where = { channel_id: discord.channelId };
      const onStart = ({ user_id }: { user_id: string }) => {
        listener('start', user_id);
      };
      const onStop = ({ user_id }: { user_id: string }) => {
        listener('stop', user_id);
      };
      await discord.subscribe('SPEAKING_START', onStart, where);
      await discord.subscribe('SPEAKING_STOP', onStop, where);
      return () => {
        // The frame may already be closing; there is nobody to tell if this fails.
        void discord.unsubscribe('SPEAKING_START', onStart, where).catch(() => undefined);
        void discord.unsubscribe('SPEAKING_STOP', onStop, where).catch(() => undefined);
      };
    },
  };
  current = { clientId, sdk };
  return sdk;
}
