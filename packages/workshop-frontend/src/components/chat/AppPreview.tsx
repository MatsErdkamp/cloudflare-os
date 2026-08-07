import { Circle } from '@phosphor-icons/react'
import { sampleDataRows } from '../../data/chat'
import { Badge, Text } from '@matser/ui'
/**
 * App tab = live preview of the running app.
 * This renders a mock of what the deployed Slack summarizer looks like.
 */
export default function AppPreview() {
  return (
    <div className="flex flex-col h-full bg-background">
      {/* App content */}
      <div className="flex-1 overflow-auto p-6">
        {/* App header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Text variant="h2" as="h1">Channel Summarizer</Text>
            <p className="text-sm text-muted-foreground mt-1">
              Daily digest of your Slack channels, powered by Workers AI
            </p>
          </div>
          <Badge color="green">Live</Badge>
        </div>

        {/* Channel cards */}
        <div className="grid gap-3">
          {sampleDataRows.filter(r => r.unread).map((row) => (
            <div
              key={row.id}
              className="rounded-lg border border-border bg-background p-4 hover:bg-card transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-foreground">{row.channel}</span>
                  <Badge color="blue">{row.messages} msgs</Badge>
                </div>
                <span className="text-xs text-muted-foreground">{row.lastActive}</span>
              </div>
              {/* Fake summary */}
              <div className="space-y-1.5 mt-3">
                <div className="flex items-start gap-2">
                  <Circle size={5} className="text-muted-foreground mt-1.5 flex-shrink-0" weight="fill" />
                  <p className="text-sm text-muted-foreground">
                    {row.channel === '#general'
                      ? 'Team discussed Q1 planning timeline and agreed on March 15 deadline for proposals'
                      : row.channel === '#engineering'
                        ? 'Deployed v2.4.1 hotfix for auth timeout. Monitoring dashboards show latency back to normal'
                        : 'Active discussion about weekend hackathon projects and lunch plans for Friday'}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <Circle size={5} className="text-muted-foreground mt-1.5 flex-shrink-0" weight="fill" />
                  <p className="text-sm text-muted-foreground">
                    {row.channel === '#general'
                      ? '3 action items assigned, 2 decisions made'
                      : row.channel === '#engineering'
                        ? 'RFC for new caching layer received 5 approvals, moving to implementation'
                        : '12 participants, trending topics: hackathon, team lunch, offsite'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Quiet channels */}
        <div className="mt-6">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            No new activity
          </div>
          <div className="flex flex-wrap gap-2">
            {sampleDataRows.filter(r => !r.unread).map((row) => (
              <div key={row.id} className="px-3 py-1.5 rounded-md bg-muted">
                <span className="font-mono text-xs text-muted-foreground">{row.channel}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
