import { assertBody, logEndpointAudit } from '#a/utils/index.js';
import { NextFunction, Request, Response } from 'express';

export async function generateDescriptionHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const actorUid = req.user?.uid ?? null;
  try {
    const { generateDescriptionSchema } =
      await import('#a/domains/ai/schemas/index.js');
    const { generateDescriptionWithGroq } =
      await import('#a/domains/ai/groqClient.js');

    const { description } = assertBody(generateDescriptionSchema, req.body);

    const content = await generateDescriptionWithGroq(description as string);

    logEndpointAudit({
      operation: 'ai.generateDescription',
      outcome: 'success',
      actorUid,
    });

    return res.json({ content });
  } catch (error) {
    logEndpointAudit({
      operation: 'ai.generateDescription',
      outcome: 'error',
      actorUid,
      error,
    });
    return next(error);
  }
}
