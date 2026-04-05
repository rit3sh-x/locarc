import type { Session } from "./betterAuth/auth";

export type User = Session["user"];
export type { Auth, Session } from "./betterAuth/auth";
