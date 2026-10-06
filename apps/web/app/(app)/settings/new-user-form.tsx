"use client";

import { Button, Input, Label } from "@forgecy/ui";
import { UserPlus } from "lucide-react";
import { useActionState } from "react";
import { createUserAction, type NewUserState } from "./actions";

export function NewUserForm() {
  const [state, action, pending] = useActionState<NewUserState, FormData>(createUserAction, {});
  return (
    <form action={action} className="mt-4 space-y-4">
      <div className="space-y-2">
        <Label htmlFor="user-name">Name</Label>
        <Input id="user-name" name="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="user-email">Email</Label>
        <Input id="user-email" name="email" type="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="user-password">Initial password</Label>
        <Input
          id="user-password"
          name="password"
          type="password"
          minLength={12}
          autoComplete="new-password"
          required
        />
      </div>
      <label className="flex items-center gap-2 text-body-sm text-fg">
        <input type="checkbox" name="isAdmin" className="size-4 accent-primary" />
        Admin (settings, keys, budget and backups)
      </label>
      {state.error ? (
        <p role="alert" className="text-body-sm text-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-body-sm text-success">
          Account created.
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        <UserPlus aria-hidden />
        Create account
      </Button>
    </form>
  );
}
