import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { CustomerAuthProvider } from './contexts/CustomerAuthContext'
import App from './App'
import RootErrorBoundary from './components/RootErrorBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <CustomerAuthProvider>
          <App />
        </CustomerAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  </RootErrorBoundary>,
)
