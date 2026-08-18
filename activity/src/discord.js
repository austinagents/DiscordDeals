import {
  DiscordSDK
} from "@discord/embedded-app-sdk";

let discordSdk = null;
let auth = null;

function hasDiscordActivityContext() {
  try {
    const params =
      new URLSearchParams(
        window.location.search
      );

    return Boolean(
      params.get("frame_id")
    );
  } catch {
    return false;
  }
}

function getDiscordSdk() {
  if (discordSdk) {
    return discordSdk;
  }

  if (!hasDiscordActivityContext()) {
    return null;
  }

  try {
    discordSdk =
      new DiscordSDK(
        import.meta.env
          .VITE_DISCORD_CLIENT_ID
      );

    return discordSdk;
  } catch (error) {
    console.warn(
      "Discord SDK could not initialize:",
      error
    );

    return null;
  }
}

export async function initializeDiscord() {
  const sdk =
    getDiscordSdk();

  /*
   * Normal localhost development:
   * render Creator Deals immediately.
   */
  if (!sdk) {
    console.log(
      "✓ Creator Deals local development mode"
    );

    auth = {
      development: true
    };

    return {
      auth,
      accessToken: null
    };
  }

  /*
   * Real Discord Activity iframe.
   */
  try {
    await sdk.ready();

    console.log(
      "✓ Discord Activity SDK ready"
    );

    auth = {
      development: true,
      discordActivity: true
    };

    return {
      auth,
      accessToken: null
    };

  } catch (error) {
    /*
     * Never allow SDK failure to kill React.
     */
    console.warn(
      "Discord SDK ready() failed; continuing in development mode:",
      error
    );

    auth = {
      development: true
    };

    return {
      auth,
      accessToken: null
    };
  }
}

export function getAuth() {
  return auth;
}

export async function openExternal(url) {
  if (!url) {
    return;
  }

  const sdk =
    getDiscordSdk();

  if (sdk) {
    try {
      await sdk.ready();

      await sdk.commands
        .openExternalLink({
          url
        });

      return;

    } catch (error) {
      console.warn(
        "Discord external link failed:",
        error
      );
    }
  }

  window.open(
    url,
    "_blank",
    "noopener,noreferrer"
  );
}
