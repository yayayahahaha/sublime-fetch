FB.login(function(){
  FB.api('/me/feed', 'post', {message: 'Hello, world!!!!!!!'});
}, {scope: 'publish_actions', auth_type: 'rerequest'});

FB.ui({
	method: 'feed',
	link: "https://codepen.io",
	picture: "https://www.google.com.tw/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png",
	name: "Title!!!",
	caption: "author name",
	description: "我是描述",
	message: "我不知道?",
	redirect_uri: "http://fb-sample-flyc.c9users.io:8008/app/"
}, function(response) {
	console.log(response);
});

http://graph.facebook.com/4/picture?type=normal
http://graph.facebook.com/4/picture?type=large
http://graph.facebook.com/4/picture?type=small

/*
public_profile
user_friends
email
user_about_me
user_actions.books
user_actions.fitness
user_actions.music
user_actions.news
user_actions.video
user_actions:{app_namespace}
user_birthday
user_education_history
user_events
user_games_activity
user_hometown
user_likes
user_location
user_managed_groups
user_photos
user_posts
user_relationships
user_relationship_details
user_religion_politics
user_tagged_places
user_videos
user_website
user_work_history
read_custom_friendlists
read_insights
read_audience_network_insights
read_page_mailboxes
manage_pages
publish_pages
publish_actions
rsvp_event
pages_show_list
pages_manage_cta
pages_manage_instant_articles
ads_read
ads_management
business_management
pages_messaging
pages_messaging_subscriptions
pages_messaging_payments
pages_messaging_phone_number
*/