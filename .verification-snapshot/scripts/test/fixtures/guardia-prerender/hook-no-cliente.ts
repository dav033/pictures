import React, { useState } from "react";

export function useReloj() {
  const [ahora] = useState(() => Date.now());
  const [azar] = React.useState(() => Math.random());
  return ahora + azar;
}
