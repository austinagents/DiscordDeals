import {
  DiscordSDK
} from "@discord/embedded-app-sdk";

let discordSdk = null;
let auth = null;

function isLocalDevelopment() {
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

export function isDiscordActivity() {
  const params =
    new URLSearchParams(
      window.location.search
    );

  return Boolean(
    params.get("frame_id") ||
    params.get("instance_id")
  );
}

function getDiscordSdk() {
  if (discordSdk) {
    return discordSdk;
  }

  if (isLocalDevelopment()) {
    return null;
  }

  discordSdk =
    new DiscordSDK(
      import.meta.env.VITE_DISCORD_CLIENT_ID
    );

  return discordSdk;
}

export async function initializeDiscord() {
  /*
   * Localhost development.
   */
  if (isLocalDevelopment()) {
    console.log(
      "✓ Creator Deals localhost development mode"
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
   * Normal partnerlinks.app browser.
   * Do not initialize Discord's Embedded App SDK.
   */
  if (!isDiscordActivity()) {
    return {
      auth: null,
      accessToken: null,
      browser: true
    };
  }

  const sdk =
    getDiscordSdk();

  await sdk.ready();

  console.log(
    "✓ Discord Activity SDK ready"
  );

  const {
    code
  } =
    await sdk.commands.authorize({
      client_id:
        import.meta.env
          .VITE_DISCORD_CLIENT_ID,

      response_type:
        "code",

      state:
        "",

      prompt:
        "none",

      scope: [
        "identify"
      ]
    });

  if (!code) {
    throw new Error(
      "Discord authorization did not return a code"
    );
  }

  const tokenResponse =
    await fetch(
      "/api/token",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            code
          })
      }
    );

  const tokenData =
    await tokenResponse.json();

  if (
    !tokenResponse.ok ||
    !tokenData?.access_token
  ) {
    throw new Error(
      tokenData?.error ||
      "Discord token exchange failed"
    );
  }

  const accessToken =
    tokenData.access_token;

  auth =
    await sdk.commands.authenticate({
      access_token:
        accessToken
    });

  if (!auth) {
    throw new Error(
      "Discord authentication failed"
    );
  }

  console.log(
    `✓ Authenticated Discord user ${auth.user?.username || auth.user?.id || ""}`
  );

  return {
    auth,
    accessToken
  };
}

export function getAuth() {
  return auth;
}

export async function openExternal(url) {
  if (!url) {
    return;
  }

  if (isLocalDevelopment()) {
    window.open(
      url,
      "_blank",
      "noopener,noreferrer"
    );

    return;
  }

  const sdk =
    getDiscordSdk();

  await sdk.commands
    .openExternalLink({
      url
    });
}
