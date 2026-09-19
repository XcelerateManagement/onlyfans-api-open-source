import { MetadataRoute } from "next";

/**
 * A self-hosted panel is not a website to be indexed — it is an operator's
 * private console holding creator and fan data. Disallow everything.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
