import { JsonLd } from "@/components/ui/JsonLd";

export interface FaqQA {
  question: string;
  answer: string;
}

export function JsonLdFaq({ qas }: { qas: FaqQA[] }) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: qas.map((qa) => ({
          "@type": "Question",
          name: qa.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: qa.answer,
          },
        })),
      }}
    />
  );
}
