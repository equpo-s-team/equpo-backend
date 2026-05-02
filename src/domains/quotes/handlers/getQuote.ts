import { ERROR_STATUS } from '#a/constants/httpStatusCodes.js';
import { config } from '#a/config.js';
import { EqupoError } from '#a/types/EqupoError.js';
import { RequestHandler } from 'express';

interface ApiNinjasQuote {
  quote: string;
  author: string;
  category: string;
}

export const getQuote: RequestHandler = async (_req, res, next) => {
  try {
    const response = await globalThis.fetch('https://api.api-ninjas.com/v1/quotes', {
      headers: { 'X-Api-Key': config.apiNinjasKey },
    });

    if (!response.ok) {
      throw new EqupoError(
        `Quotes API request failed (${response.status})`,
        ERROR_STATUS.SERVER_ERROR
      );
    }

    const data = (await response.json()) as ApiNinjasQuote[];

    if (!data.length) {
      throw new EqupoError('No quotes returned from API', ERROR_STATUS.SERVER_ERROR);
    }

    const { quote, author, category } = data[0];
    return res.json({ quote, author, category });
  } catch (error) {
    return next(error);
  }
};
