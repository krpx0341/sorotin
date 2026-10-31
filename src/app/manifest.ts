import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sorotin",
    short_name: "Sorotin",
    description: "Sorot momen terbaikmu. Video panjang jadi klip 9:16.",
    start_url: "/",
    display: "standalone",
    background_color: "#0A0F0D",
    theme_color: "#0A0F0D",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
