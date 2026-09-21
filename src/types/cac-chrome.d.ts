import type { HTMLAttributes } from "react";

type CacHeaderProps = HTMLAttributes<HTMLElement> & {
  active?: string;
  base?: string;
  theme?: "light" | "dark";
  "hide-join"?: string | boolean;
  "hide-theme"?: string | boolean;
  "events-href"?: string;
  "forum-href"?: string;
};

type CacFooterProps = HTMLAttributes<HTMLElement> & {
  flush?: string | boolean;
  cta?: "join" | "forum";
  base?: string;
  theme?: "light" | "dark";
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "cac-header": CacHeaderProps;
      "cac-footer": CacFooterProps;
    }
  }
}

export {};
