import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LightNode",
    short_name: "LightNode",
    description: "One-flow onboarding for LightChain AI workers.",
    start_url: "/",
    display: "standalone",
    background_color: "#070710",
    theme_color: "#070710",
    icons: [{ src: "/lightnode-mark.png", sizes: "512x512", type: "image/png" }],
  };
}
