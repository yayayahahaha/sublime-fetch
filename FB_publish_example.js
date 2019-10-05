FB.login(function() {
  FB.api('/me/feed', 'post', {
    message: 'Hello, world!!!!!!!'
  });
}, {
  scope: 'publish_actions',
  auth_type: 'rerequest',
  return_scopes: true
});

FB.ui({
  method: 'feed',
  link: 'https://codepen.io',
  picture: 'https://www.google.com.tw/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png',
  name: 'Title!!!',
  caption: 'author name',
  description: '我是描述',
  message: '我不知道?',
  redirect_uri: 'http://fb-sample-flyc.c9users.io:8008/app/'
}, function(response) {
  console.log(response);
});

FB.ui({
    method: 'share',
    href: 'your_url', // The same than link in feed method
    title: 'your_title', // The same than name in feed method
    picture: 'path_to_your_picture',
    caption: 'your_caption',
    hashtag: 'tag',
    quote: 'quote',
    description: 'your_description',
    mobile_iframe: true
  },
  function(response) {
    // your code to manage the response
  });

var data = {
  'url': 'http://www.fashionguide.com.tw',
  'redirectUri': 'https://actives.fashionguide.com.tw/cosmed/endpage',
  'name': '快來FashionGuide APP玩任務→週週送25G幣',
  'author': '1028',
  'description': '夏天來啦～臉上的油光是不是也hold不住了呢？FG APP要送你1028控油4天王獨家折扣，最高現折100元!!! 週週分享加碼再送25G幣喔！',
  'picture': 'https://actives.fashionguide.com.tw' + that.imgSrc
};

function fbShare(data) {
  var fbArray = [
    'https://m.facebook.com/dialog/feed?app_id=',
    1590515954569893,
    '&link=',
    encodeURIComponent(data.url),
    '&picture=',
    encodeURIComponent(data.picture),
    '&redirect_uri=',
    encodeURIComponent(data.redirectUri),
    '&name=',
    encodeURIComponent(data.name),
    '&description=',
    encodeURIComponent(data.description),
    '&caption=',
    encodeURIComponent(data.author),

  ];
  window.location.href = fbArray.join('');
}

fbShare(data);
/*
XXX_YYY
https: //www.facebook.com/XXX/posts/YYY

  http: //graph.facebook.com/4/picture?type=normal
  http: //graph.facebook.com/4/picture?type=large
  http: //graph.facebook.com/4/picture?type=small
*/
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