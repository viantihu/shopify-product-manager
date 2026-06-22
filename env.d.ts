/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

// `@shopify/polaris-types` registers every `s-*` Polaris web component as a JSX
// intrinsic, but not the App Bridge `s-app-nav` element used by the embedded app
// shell in `app/routes/app.tsx`. Declare it here so the JSX typecheck stays clean.
// (This gap was previously masked by unrelated compile errors in app.format.tsx;
// deleting that route surfaced it.)
import type { HTMLAttributes } from "react";

type AppNavProps = HTMLAttributes<HTMLElement>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": AppNavProps;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": AppNavProps;
    }
  }
}
