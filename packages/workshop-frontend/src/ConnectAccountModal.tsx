import { useState, useEffect } from 'react'
import { RpcStub } from 'capnweb'
import { AuthenticatedApi, GatekeeperVendorFilter } from '@gadgets/workshop-shared/api'
import { VendorDescription } from '@gadgets/workshop-shared/gatekeeper'
import VendorCard from './VendorCard'
import { Dialog, Text, Spinner, useToast, DialogContent, DialogTitle } from '@matser/ui'
interface ConnectAccountModalProps {
  visible: boolean
  onCancel: () => void
  onInitiated: () => void
  authenticatedApi: RpcStub<AuthenticatedApi>
  /** Optional filter to only show vendors supporting certain features */
  filter?: GatekeeperVendorFilter
}

interface VendorOption {
  id: string
  description: VendorDescription
}

export default function ConnectAccountModal({
  visible,
  onCancel,
  onInitiated,
  authenticatedApi,
  filter,
}: ConnectAccountModalProps) {
  const toasts = useToast()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(true)

  // Fetch vendors when modal opens
  useEffect(() => {
    if (!visible) {
      setConnecting(null)
      return
    }

    const fetchVendors = async () => {
      setVendorsLoading(true)
      try {
        const vendorList = await authenticatedApi.listGatekeeperVendors(filter)
        const unavailable = vendorList.filter(v => v.unavailable)
        if (unavailable.length > 0) {
          toasts.add({
            title: `Some services are temporarily unavailable: ${unavailable.map(v => v.id).join(', ')}`,
            type: 'warning',
          })
        }
        setVendors(vendorList.filter(v => !v.unavailable).map(v => ({ id: v.id, description: v.description })))
      } catch (error) {
        console.error('Failed to fetch vendors:', error)
        toasts.add({ title: 'Failed to load available services', type: 'error' })
      } finally {
        setVendorsLoading(false)
      }
    }

    fetchVendors()
  }, [visible, authenticatedApi, filter])

  const handleConnect = async (vendorId: string) => {
    setConnecting(vendorId)
    try {
      const result = await authenticatedApi.connectAccount(vendorId)
      window.open(result.url, '_blank', 'noopener,noreferrer')
      onInitiated()
    } catch (error) {
      console.error('Failed to initiate connection:', error)
      toasts.add({ title: 'Failed to start connection flow', type: 'error' })
      setConnecting(null)
    }
  }

  return (
    <Dialog open={visible} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="p-6" size="md">
        <DialogTitle className="text-lg font-semibold mb-4">Connect Account</DialogTitle>
        {vendorsLoading ? (
          <div className="text-center py-8">
            <Spinner />
          </div>
        ) : vendors.length === 0 ? (
          <div className="text-center py-8">
            <Text variant="muted">No services available to connect.</Text>
          </div>
        ) : (
          <div className="flex flex-col gap-3 mt-2">
            {vendors.map(vendor => (
              <VendorCard
                key={vendor.id}
                vendor={vendor.description}
                onClick={() => handleConnect(vendor.id)}
                loading={connecting === vendor.id}
                disabled={connecting !== null && connecting !== vendor.id}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
