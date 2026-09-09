/* Єдиний фон сайту — як на «Медичному хабі»: темний радіальний градієнт
   + рухома бірюзова перспективна сітка. Підключається на всіх сторінках. */
(function () {
    try {
        var css = document.createElement('style');
        css.textContent =
            '.nadiya-bg{position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:-1;overflow:hidden;pointer-events:none;' +
            'background:radial-gradient(circle at center,#12202b 0%,#08090b 100%);}' +
            '.nadiya-bg .g{position:absolute;width:200%;height:200%;top:-50%;left:-50%;' +
            'background-image:linear-gradient(rgba(32,201,151,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(32,201,151,.045) 1px,transparent 1px);' +
            'background-size:50px 50px;transform:perspective(500px) rotateX(60deg);animation:nadiyaGrid 20s linear infinite;}' +
            '@keyframes nadiyaGrid{0%{transform:perspective(500px) rotateX(60deg) translateY(0);}100%{transform:perspective(500px) rotateX(60deg) translateY(50px);}}';
        document.head.appendChild(css);

        // Прибираємо старі фони (наприклад, анімований біжучий текст на login/register/blog/music)
        document.querySelectorAll('.animated-background').forEach(function (el) { el.style.display = 'none'; });

        var bg = document.createElement('div');
        bg.className = 'nadiya-bg';
        bg.innerHTML = '<div class="g"></div>';
        document.body.insertBefore(bg, document.body.firstChild);

        // Тіло — темне (щоб градієнт/сітка читались однаково скрізь)
        document.body.style.backgroundColor = '#08090b';
    } catch (e) { /* фон некритичний */ }
})();
