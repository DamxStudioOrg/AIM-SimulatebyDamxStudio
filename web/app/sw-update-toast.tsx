"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { SW_UPDATE_EVENT } from "./sw-register";

/** Update banner: a new worker installed, one refresh applies it. */
export default function SwUpdateToast(): React.ReactElement | null {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const show = (): void => {
      setAvailable(true);
    };
    window.addEventListener(SW_UPDATE_EVENT, show);
    return () => {
      window.removeEventListener(SW_UPDATE_EVENT, show);
    };
  }, []);

  if (!available) {
    return null;
  }
  return (
    <div className="update-toast" role="status">
      <p>A new version of simulate is ready.</p>
      <Button
        variant="primary"
        size="small"
        onClick={() => {
          window.location.reload();
        }}
      >
        Refresh
      </Button>
    </div>
  );
}
