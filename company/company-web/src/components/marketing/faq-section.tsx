import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { SectionHeading } from './section-heading';
import { FAQS } from '@/lib/content';

export function FaqSection({ limit }: { limit?: number }) {
  const items = limit ? FAQS.slice(0, limit) : FAQS;
  const half = Math.ceil(items.length / 2);
  const columns = [items.slice(0, half), items.slice(half)];

  return (
    <section className="py-20 sm:py-24">
      <div className="container-page space-y-12">
        <SectionHeading
          title={
            <>
              Frequently Asked <span className="text-gradient">Questions</span>
            </>
          }
          description="Everything you need to know before you start."
        />

        <div className="grid gap-4 lg:grid-cols-2">
          {columns.map((column, columnIndex) => (
            <Accordion key={columnIndex} type="single" collapsible className="space-y-3">
              {column.map((faq, i) => (
                <AccordionItem key={faq.question} value={`item-${columnIndex}-${i}`}>
                  <AccordionTrigger>{faq.question}</AccordionTrigger>
                  <AccordionContent>{faq.answer}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ))}
        </div>
      </div>
    </section>
  );
}
