import { DiscordSDK } from '@discord/embedded-app-sdk';

/** The Discord permissions Stagehand asks for: who the player is, and who talks (F3.9). */
export type ActivityScope = 'identify' | 'rpc.voice.read';

export type SpeakingKind = 'start' | 'stop';

/** What signing the SDK in gives: the permissions granted, and who the player is on Discord. */
export interface Authenticated {
  scopes: string[];
  /** The player's Discord user id: speaking events name people by it. */
  userId: string;
}

/** The few parts of Discord's Embedded App SDK that Stagehand uses. */
export interface ActivitySdk {
  /** "desktop" (the desktop app and the website) or "mobile". */
  readonly platform: string;
  /** Resolves once the frame and the Discord client have shaken hands. */
  ready(): Promise<void>;
  /** Asks the user to allow the scopes (Discord shows its own dialog); resolves to a code. */
  authorize(scopes: readonly ActivityScope[]): Promise<string>;
  /**
   * Signs the SDK in with the token the server got for that code. Only the first call in a
   * launch signs in: later calls resolve to the same answer.
   */
  authenticate(accessToken: string): Promise<Authenticated>;
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
  /** The permissions the page is signed in to the SDK with, once it is. */
  let authenticated: Promise<Authenticated> | null = null;

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
    authenticate: (accessToken) => {
      // Discord takes this once per launch: a second call fails with "Already authenticated"
      // (code 4002). So the first answer is kept, and asking again (the test's Run again)
      // gets the permissions the page is already signed in with.
      authenticated ??= discord.commands
        .authenticate({ access_token: accessToken })
        .then(({ scopes, user }) => ({
          scopes: scopes.filter((scope) => typeof scope === 'string'),
          userId: user.id,
        }))
        .catch((error: unknown) => {
          // Not signed in after all: the next call may try again.
          authenticated = null;
          throw error;
        });
      return authenticated;
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
