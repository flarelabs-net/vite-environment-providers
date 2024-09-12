# Remix App Node-VM Example

Minimal Remix application that uses the `vite-environment-provider-node-vm` package to run the app's server side code inside a node vm.

> [!Note]
> The `@remix-run/dev` package is a build generated from the code at:
> https://github.com/dario-piotrowicz/remix/tree/2.9.1-vite-env-4

## Key aspects

Some key aspects to note regarding this example are:

- that we've added two options to the remix plugin: `ssrEnvironment` and `ssrRuntime`, the former allows the user to provide the environment to be used while the latter is for letting remix know what runtime is being targeted, this is necessary so that remix can use the correct entrypoint for the current runtime.\
  \
  Relevant remix code references:

  - [creating the ssr environment](https://github.com/dario-piotrowicz/remix/blob/6a8c12380453c7fd01718810683475ccdb690eff/packages/remix-dev/vite/plugin.ts#L1049-L1065)
  - [creating a handler using the dev environment](https://github.com/dario-piotrowicz/remix/blob/6a8c12380453c7fd01718810683475ccdb690eff/packages/remix-dev/vite/plugin.ts#L1427-L1431)

- note that in the remix plugin we specify the `external` option which is simply taken from the existing plugin's ssr configuration: [source](https://github.com/dario-piotrowicz/remix/blob/da96d35cf6a01578582d125ec4cb979bdb4a74f8/packages/remix-dev/vite/plugin.ts#L1056-L1077) so we're not adding this.
