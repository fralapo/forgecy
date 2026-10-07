import type { ProviderId } from "@forgecy/core";
import {
  Bot,
  Cpu,
  Image,
  MessageCircle,
  Search,
  Shuffle,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/** One icon per AI provider, used on every provider card so they scan as a set. */
export const providerIcons: Record<ProviderId, LucideIcon> = {
  anthropic: Sparkles,
  openai: Bot,
  openrouter: Shuffle,
  deepseek: Search,
  google: Image,
  local: Cpu,
  higgsfield: Image,
  weave: Image,
};

/** Icon for the “Sign in with ChatGPT” card, which is not itself a provider id. */
export const SiwcIcon: LucideIcon = MessageCircle;
