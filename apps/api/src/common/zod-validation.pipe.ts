import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Validates request payloads with a Zod schema and returns the parsed
 * (sanitized) value. Used per-route: `@Body(new ZodValidationPipe(loginSchema))`.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: "validation_error",
        issues: result.error.flatten(),
      });
    }
    return result.data;
  }
}
