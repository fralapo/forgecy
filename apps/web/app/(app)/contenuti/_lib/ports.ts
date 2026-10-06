import "server-only";
import { registerContentPorts } from "@forgecy/content/wiring";

// Product catalog and Brand Guard for the content module (once per server process).
registerContentPorts();
