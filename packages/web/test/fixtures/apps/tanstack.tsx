// A real React + TanStack Router app: the SDK sees only the History API, no framework hook.
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'

const root = createRootRoute({
  component: () => (
    <>
      <nav>
        <Link id="to-home" to="/app">
          home
        </Link>
        <Link id="to-a" to="/app/a">
          a
        </Link>
        <Link id="to-b" to="/app/b/$id" params={{ id: '1012345678' }} search={{ q: 'secret@example.com' }}>
          b
        </Link>
      </nav>
      <Outlet />
    </>
  ),
})
const routes = [
  createRoute({ getParentRoute: () => root, path: '/app', component: () => <h1>home</h1> }),
  createRoute({ getParentRoute: () => root, path: '/app/a', component: () => <h1>a</h1> }),
  createRoute({ getParentRoute: () => root, path: '/app/b/$id', component: () => <h1>b</h1> }),
]
const router = createRouter({ routeTree: root.addChildren(routes) })
createRoot(document.getElementById('root') as HTMLElement).render(<RouterProvider router={router} />)
