import { JsonLd } from "@/components/ui/JsonLd";

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function JsonLdBreadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.name,
          item: item.url,
        })),
      }}
    />
  );
}
