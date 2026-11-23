import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { CustomerAuthProvider } from './contexts/CustomerAuthContext'
import App from './App'
import RootErrorBoundary from './components/RootErrorBoundary'
import DialogHost from './components/ui/DialogHost'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <CustomerAuthProvider>
          <App />
          <DialogHost />
        </CustomerAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  </RootErrorBoundary>,
)
