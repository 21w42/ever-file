import Vue from 'vue'
import VueRouter, { RouteConfig } from 'vue-router'
import HomeView from '../views/HomeView.vue'

Vue.use(VueRouter)

const routes: Array<RouteConfig> = [
  {
    path: '/',
    name: 'HomeView',
    component: HomeView
  },
  {
    path: '/file/:fileId',
    name: 'fileView',    
    component: () => import('../views/FileView.vue')
  },
  {
    path: '/image/:fileId',
    name: 'imageView',    
    component: () => import('../views/ImageView.vue')
  }
]

const router = new VueRouter({
  routes
})

export default router
