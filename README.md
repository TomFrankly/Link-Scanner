# Link Scanner

Finds broken, parked, and unexpectedly redirected links in the descriptions of YouTube videos. It uses the YouTube Data API with an API key, so it only reads public data.

The app lives in [`app/`](app/README.md): a Cloudflare Worker with a Svelte UI that runs on the Workers Free plan, behind Cloudflare Access. Its README covers how it works, local development, and [deploying your own copy](app/README.md#deploy-your-own-copy).

Released under the [MIT License](LICENSE).
