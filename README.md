> [!WARNING]
> This repository has been archived in favour of https://github.com/flarelabs-net/vite-plugin-cloudflare

# Vite Environment Providers

Experimentations based on the [_experimental_ Vite Environment API](https://deploy-preview-16471--vite-docs-main.netlify.app/guide/api-vite-environment.html) being worked on for `vite@6.0.0-alpha.x`

## Setup

Simply run:

```
$ pnpm i
```

to install all the dependencies and build all the packages in this repository, there you can `cd` in any of the examples and run their development scripts.

## Monorepo Structure

- `packages`

  Basically contains plugins that using the Vite Environment API allow to run code in Alternative JS Runtimes

- `examples`

  Contains examples of usages of the above mentioned runtime packages

> [!NOTE]
> All the packages and examples have their own README files explaining the package/example

> [!NOTE]
> The most important example currently here is `remix-app-cloudflare` which uses `packages/vite-environment-provider-cloudflare` to server side render a Remix application in the Cloudflare environment.

## Syncpack

[Syncpack](https://jamiemason.github.io/syncpack/) can be used to find and fix dependency version mismatches. The most useful commands are `pnpm syncpack list-mismatches` and `pnpm syncpack fix-mismatches`.

### Credits & References

- [**Vite Environment API GitHub discussion**](https://github.com/vitejs/vite/discussions/16358)
- [**vite-environment-examples** (by _hi-ogawa_)](https://github.com/hi-ogawa/vite-environment-examples)
