<template>
  <h1>This is {{ $options.name }} Page</h1>
  <router-link to="/about">about</router-link>
</template>

<script>
export default {
  name: 'HomeView',
}
</script>
