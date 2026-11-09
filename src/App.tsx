import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from './app/AppShell'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 4000,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  )
}
