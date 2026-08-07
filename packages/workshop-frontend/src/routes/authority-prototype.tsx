import { createFileRoute } from '@tanstack/react-router'
import AuthorityReviewPrototype from '../prototypes/AuthorityReviewPrototype'

export type AuthorityPrototypeVariant = 'A' | 'B' | 'C'

type AuthorityPrototypeSearch = {
  variant?: AuthorityPrototypeVariant
}

export const Route = createFileRoute('/authority-prototype')({
  component: AuthorityReviewPrototype,
  validateSearch: (search: Record<string, unknown>): AuthorityPrototypeSearch => ({
    variant: search.variant === 'B' || search.variant === 'C' ? search.variant : 'A',
  }),
})
