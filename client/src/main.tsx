import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { CustomerAuthProvider } from './contexts/CustomerAuthContext'
import App from './App'
import RootErrorBoundary from './components/RootErrorBoundary'
import DialogHost from './components/ui/DialogHost'
import './index.css'
import { registerServiceWorker } from './lib/pwa'
import AppUpdateBanner from './components/common/AppUpdateBanner'

registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <CustomerAuthProvider>
          <App />
          <DialogHost />
          <AppUpdateBanner />
        </CustomerAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  </RootErrorBoundary>,
)
