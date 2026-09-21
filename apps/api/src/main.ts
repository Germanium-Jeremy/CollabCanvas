import { NestFactory } from "@nestjs/core";
import { pino } from "pino";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import { Request, Response } from "express";
import { AppModule } from "./app.module";
import { getEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  const env = getEnv();

  const app = await NestFactory.create(AppModule, {
    logger: false, // structured logging handled by pino-http below
  });

  app.use(
    pinoHttp({
      logger: pino({ level: env.LOG_LEVEL }),
      redact: ["req.headers.cookie", "req.headers.authorization"],
      autoLogging: { ignore: (req) => req.url?.includes("/health") ?? false },
    }),
  );
  app.use(cookieParser());

  app.enableCors({
    origin: env.WEB_ORIGIN.split(",").map((o) => o.trim()),
    credentials: true,
  });

  app.getHttpAdapter().get("/", (_req: Request, res: Response) => {
    res.json({
      message: "Welcome to the CollabCanvas API",
    });
  });

  app.setGlobalPrefix("api");
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  console.log(
    `API listening on http://localhost:${env.PORT}/api (${env.NODE_ENV})`,
  );
}

void bootstrap().catch((error: unknown) => {
  console.error("API failed to start:", error);
  process.exitCode = 1;
});
