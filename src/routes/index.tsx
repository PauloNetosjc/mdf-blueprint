import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/" as never, replace: true, to_: undefined as never });
  },
  component: () => null,
});
