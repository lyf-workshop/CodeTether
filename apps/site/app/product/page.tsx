import type { Metadata } from 'next'
import { ProductPageContent } from '../../components/marketing-page'

export const metadata: Metadata = { title: 'Product' }

export default function ProductPage() {
  return <ProductPageContent />
}
