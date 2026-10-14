"use client";

import { Page } from "@/components/site/Page";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/Button";

/** Any render failure (e.g. an API answer the page can't read) keeps the site header and says what to do,
 *  without the error's details. */
export default function SiteError({ retry }: { retry: () => void }) {
  return (
    <Page title="Something went wrong">
      <Box tone="loss" title="this page couldn't load">
        <p>
          Tilt sent something this page couldn&apos;t show. If you just sent a deposit or withdrawal, check your balance
          before sending it again.
        </p>
        <div>
          <Button onClick={retry}>retry</Button>
        </div>
      </Box>
    </Page>
  );
}
