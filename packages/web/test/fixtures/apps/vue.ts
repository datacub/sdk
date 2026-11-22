// A real Vue + vue-router app, written with render functions so no compiler is needed.
import { createApp, h } from 'vue'
import { createRouter, createWebHistory, RouterLink, RouterView } from 'vue-router'

const page = (name: string) => ({ render: () => h('h1', name) })
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/vue', component: page('home') },
    { path: '/vue/a', component: page('a') },
    { path: '/vue/orders/:id', component: page('order') },
  ],
})
createApp({
  render: () => [
    h('nav', [
      h(RouterLink, { id: 'to-a', to: '/vue/a' }, () => 'a'),
      h(RouterLink, { id: 'to-order', to: '/vue/orders/550e8400-e29b-41d4-a716-446655440000' }, () => 'o'),
    ]),
    h(RouterView),
  ],
})
  .use(router)
  .mount('#root')
