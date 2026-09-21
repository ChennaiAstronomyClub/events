import { useEffect } from "react";
import { ensureCacChrome } from "@/lib/cac-chrome";

export function Footer() {
  useEffect(() => {
    void ensureCacChrome();
  }, []);

  return <cac-footer />;
}
