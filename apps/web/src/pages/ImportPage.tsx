import { importModeSchema, type Campaign } from '@stagehand/shared';
import { Link, useParams, useSearchParams } from 'react-router';

import { ImportForm, type ImportFormInitial } from '@/components/ai-import/ImportForm';
import { ImportList } from '@/components/ai-import/ImportList';
import { PlayersNote } from '@/components/records/PlayersNote';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useCampaign,
  useImport,
  useImports,
  useProviderCredentials,
  useRecords,
} from '@/lib/queries';
import { CampaignNotFound } from '@/pages/CampaignPage';

/**
 * `/campaigns/:campaignId/import` (F1.8b): a new AI import, and the campaign's past imports
 * below. `?mode=fill&record=<id>` presets filling in a record; `?from=<importId>` refills
 * the form from an earlier import ("Try again").
 */
export function ImportPage() {
  const { campaignId = '' } = useParams();
  const { data: campaign, isPending, isError } = useCampaign(campaignId);

  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (isError) return <p role="alert">Could not load this campaign. Try again in a moment.</p>;
  if (campaign === null) return <CampaignNotFound />;
  return <ImportView campaign={campaign} />;
}

function ImportView({ campaign }: { campaign: Campaign }) {
  const isGm = campaign.role === 'gm';
  const backLink = (
    <Link
      to={`/campaigns/${campaign.id}`}
      className="text-sm text-muted-foreground hover:underline"
    >
      ← {campaign.name}
    </Link>
  );
  if (!isGm) {
    return (
      <div className="space-y-4">
        {backLink}
        <PlayersNote />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {backLink}
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl">AI import</h1>
          </CardTitle>
          <CardDescription>
            Write a brain-dump; Claude turns it into proposed records, changes and links, and you
            review each one before anything is saved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewImport campaign={campaign} />
        </CardContent>
      </Card>
      <PastImports campaignId={campaign.id} />
    </div>
  );
}

function NewImport({ campaign }: { campaign: Campaign }) {
  const [params] = useSearchParams();
  const from = params.get('from');
  const credentials = useProviderCredentials();
  const records = useRecords(campaign.id, undefined, true);
  const earlier = useImport(campaign.id, from ?? '', from !== null);

  if (campaign.archivedAt !== null) {
    return (
      <p className="rounded-md border bg-muted px-4 py-3 text-sm">
        This campaign is archived, so nothing can be imported into it.
      </p>
    );
  }
  if (credentials.isPending || records.isPending || (from !== null && earlier.isPending)) {
    return <p className="text-muted-foreground">Loading…</p>;
  }
  if (credentials.isError || records.isError) {
    return <p role="alert">Could not load the import form. Try again in a moment.</p>;
  }
  if (!credentials.data.some((credential) => credential.provider === 'anthropic')) {
    return (
      <div className="space-y-2 rounded-md border px-4 py-3">
        <p className="font-medium">Add your Anthropic API key first</p>
        <p className="text-sm text-muted-foreground">
          AI import runs on your own Anthropic account. Add a key in Settings, then come back here.
        </p>
        <Link to="/settings" className="text-sm underline">
          Open Settings
        </Link>
      </div>
    );
  }

  const source = earlier.data ?? null;
  const urlMode = importModeSchema.safeParse(params.get('mode'));
  const initial: ImportFormInitial =
    source !== null
      ? {
          mode: source.mode,
          text: source.text,
          targetTypes: source.targetTypes,
          recordId: source.recordId,
        }
      : {
          ...(urlMode.success ? { mode: urlMode.data } : {}),
          recordId: params.get('record'),
        };
  return (
    <ImportForm
      key={`${from ?? ''}:${params.get('record') ?? ''}`}
      campaignId={campaign.id}
      records={records.data}
      initial={initial}
    />
  );
}

function PastImports({ campaignId }: { campaignId: string }) {
  const imports = useImports(campaignId, true);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-xl">Past imports</h2>
        </CardTitle>
        <CardDescription>
          What each import proposed, and what it cost at Anthropic&apos;s list prices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {imports.isPending && <p className="text-muted-foreground">Loading…</p>}
        {imports.isError && <p role="alert">Could not load the imports. Try again in a moment.</p>}
        {imports.isSuccess && <ImportList imports={imports.data} />}
      </CardContent>
    </Card>
  );
}
