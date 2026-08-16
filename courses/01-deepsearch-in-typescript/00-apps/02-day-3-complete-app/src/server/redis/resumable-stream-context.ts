import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream/ioredis";
import { Redis } from "ioredis";
import { env } from "~/env";

export const streamContext = createResumableStreamContext({
  waitUntil: after,
  publisher: new Redis(env.REDIS_URL),
  subscriber: new Redis(env.REDIS_URL),
});
