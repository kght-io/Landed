"use client";

import { useEffect } from "react";

export default function PendoInitializer() {
  useEffect(() => {
    pendo.initialize({ visitor: { id: "" } });
  }, []);
  return null;
}
