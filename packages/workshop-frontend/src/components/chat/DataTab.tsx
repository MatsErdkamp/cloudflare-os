import { useState } from 'react'
import { sampleDataRows } from '../../data/chat'
import { Table, Badge, Button, TableHeader, TableHead, TableBody, TableRow, TableCell, TableCheckCell, TableCheckHead } from '@matser/ui'
export default function DataTab() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedIds.size === sampleDataRows.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sampleDataRows.map((r) => r.id)))
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-accent bg-card">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-foreground">channels</span>
          <Badge>{sampleDataRows.length} rows</Badge>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <span className="text-xs text-muted-foreground">
              {selectedIds.size} selected
            </span>
          )}
          <Button variant="ghost" size="xs">Filter</Button>
          <Button variant="ghost" size="xs">Sort</Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table layout="fixed">
          <TableHeader>
            <TableRow>
              <TableCheckHead
                checked={selectedIds.size === sampleDataRows.length}
                indeterminate={selectedIds.size > 0 && selectedIds.size < sampleDataRows.length}
                onCheckedChange={toggleAll}
                aria-label="Select all rows"
              />
              <TableHead>Channel</TableHead>
              <TableHead>Messages</TableHead>
              <TableHead>Last Active</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sampleDataRows.map((row) => (
              <TableRow key={row.id} variant={selectedIds.has(row.id) ? 'selected' : 'default'}>
                <TableCheckCell
                  checked={selectedIds.has(row.id)}
                  onCheckedChange={() => toggleRow(row.id)}
                  aria-label={`Select ${row.channel}`}
                />
                <TableCell>
                  <span className="font-mono text-sm text-foreground">{row.channel}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {row.messages.toLocaleString()}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">{row.lastActive}</span>
                </TableCell>
                <TableCell>
                  {row.unread ? (
                    <Badge color="blue">Unread</Badge>
                  ) : (
                    <Badge>Read</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-accent bg-card flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">
          {sampleDataRows.length} rows in channels
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {sampleDataRows.reduce((sum, r) => sum + r.messages, 0).toLocaleString()} total messages
        </span>
      </div>
    </div>
  )
}
